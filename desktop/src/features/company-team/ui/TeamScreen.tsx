import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveJobTitle } from "@/features/profile/lib/jobTitle";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { truncateNpub } from "@/shared/lib/pubkey";
import { ChevronRightIcon, PlusIcon } from "@/shared/ui/colonyIcons";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { useEmployeeRuntime } from "../useEmployeeRuntime";
import { usePersonasQuery } from "@/features/agents/hooks";
import { TeamPage, TeamPageTitle } from "./TeamPage";
import { useCompanyTeamQuery } from "../teamRelay";
import type { TeamMember } from "../teamModels";

type ProfileLookup = Record<
  string,
  {
    displayName: string | null;
    avatarUrl?: string | null;
    jobTitle?: string | null;
  }
>;

function displayName(member: TeamMember, profiles: ProfileLookup) {
  return (
    profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function memberKindLabel(member: TeamMember) {
  return member.kind === "employee" ? "AI employee" : "Human";
}

function countLabel(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

type StatusTone = "working" | "ready" | "attention" | "idle";

/** The pill beside a name. Humans read as plain "Active" text, never a pill. */
function StatusCell({
  member,
  runtimeLabel,
}: {
  member: TeamMember;
  runtimeLabel: string;
}) {
  const position = member.position?.head;
  const reason = position?.reason;
  if (member.kind === "human") {
    return (
      <span className="team-status-plain">
        <span className="team-status-dot" />
        {position?.status === "active" || !position
          ? "Active"
          : position.status}
      </span>
    );
  }
  if (position && position.status !== "active") {
    const label = position.status === "paused" ? "Paused" : "Terminated";
    return (
      <span className="team-status">
        <span className="team-status-chip" data-tone="idle">
          {position.status === "paused" ? (
            <svg
              aria-hidden="true"
              fill="currentColor"
              height="0.75rem"
              viewBox="0 0 24 24"
              width="0.75rem"
            >
              <rect height="14" rx="1" width="4" x="6" y="5" />
              <rect height="14" rx="1" width="4" x="14" y="5" />
            </svg>
          ) : null}
          {label}
        </span>
        {reason ? <span className="team-status-reason">{reason}</span> : null}
      </span>
    );
  }
  const tone: StatusTone =
    runtimeLabel === "Working"
      ? "working"
      : runtimeLabel === "Ready"
        ? "ready"
        : runtimeLabel === "Needs attention"
          ? "attention"
          : "idle";
  return (
    <span className="team-status-chip" data-tone={tone}>
      {tone === "attention" ? (
        <svg
          aria-hidden="true"
          fill="none"
          height="0.8125rem"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.6"
          viewBox="0 0 24 24"
          width="0.8125rem"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4.5M12 16v.2" />
        </svg>
      ) : (
        <span
          className="team-status-dot"
          data-hollow={tone === "idle" ? "true" : undefined}
        />
      )}
      {runtimeLabel}
    </span>
  );
}

function TeamMemberRow({
  member,
  name,
  jobTitle,
  managerName,
  avatarUrl,
  definitionAvatar,
}: {
  member: TeamMember;
  name: string;
  jobTitle: string;
  managerName: string | null;
  avatarUrl?: string | null;
  definitionAvatar?: string | null;
}) {
  const { goTeamMember } = useAppNavigation();
  const runtime = useEmployeeRuntime(member);
  const position = member.position?.head;
  const status =
    member.kind === "employee"
      ? position && position.status !== "active"
        ? position.status === "paused"
          ? "Paused"
          : "Terminated"
        : runtime.label
      : (position?.status ?? "active");
  const reportsTo =
    managerName ?? (member.role === "owner" ? "Company owner" : "");
  const reasonDescription = position?.reason
    ? `, Reason: ${position.reason}`
    : "";
  const accessibleName = `${name}, ${jobTitle || "No title"}, ${memberKindLabel(member)}, ${status}${reportsTo ? `, Reports to ${reportsTo}` : ""}${reasonDescription}`;
  return (
    <button
      aria-label={accessibleName}
      className="team-row"
      data-testid={`company-team-member-${member.pubkey}`}
      onClick={() => void goTeamMember(member.pubkey)}
      type="button"
    >
      <span className="team-person">
        {member.kind === "employee" ? (
          <EmployeeAvatar
            className="team-person-avatar team-person-avatar-agent"
            definition={definitionAvatar}
            instance={member.managedAgent?.avatarUrl}
            name={name}
            personaId={member.managedAgent?.personaId}
            profile={avatarUrl}
            testId={`team-avatar-${member.pubkey}`}
          />
        ) : (
          <ProfileAvatar
            avatarUrl={avatarUrl ?? null}
            className="team-person-avatar"
            label={name}
            testId={`team-avatar-${member.pubkey}`}
          />
        )}
        <span className="team-person-copy">
          <span className="team-person-name">{name}</span>
          <span className="team-person-role">
            {jobTitle ? `${jobTitle} · ` : ""}
            {memberKindLabel(member)}
          </span>
        </span>
      </span>
      <span className="team-reports-to">{reportsTo}</span>
      <StatusCell member={member} runtimeLabel={runtime.label} />
      <ChevronRightIcon
        aria-hidden="true"
        className="team-chevron"
        size={18}
        strokeWidth={2.4}
      />
    </button>
  );
}

export function TeamScreen() {
  const teamQuery = useCompanyTeamQuery();
  const identityQuery = useIdentityQuery();
  const personasQuery = usePersonasQuery();
  const { goHireRoles } = useAppNavigation();
  const members = teamQuery.data?.members ?? [];
  const memberPubkeys = React.useMemo(
    () => members.map((member) => member.pubkey),
    [members],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const role = teamQuery.data?.relayMembers.find(
    (member) =>
      member.pubkey.toLowerCase() === identityQuery.data?.pubkey.toLowerCase(),
  )?.role;
  const canHire = role === "owner" || role === "admin";

  if (
    teamQuery.isLoading ||
    teamQuery.isError ||
    !teamQuery.data?.membershipSnapshotFound
  ) {
    return (
      <TeamPage testId="company-team-screen" title="Team">
        <TeamPageTitle>Team</TeamPageTitle>
        {teamQuery.isLoading ? (
          <p aria-live="polite" className="team-message">
            Loading Team
          </p>
        ) : teamQuery.isError ? (
          <div role="alert">
            <p className="team-message team-message-error">
              This information could not load
            </p>
            <button
              className="team-retry"
              onClick={() => void teamQuery.refetch()}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="team-message" role="status">
            Team membership is unavailable for this community.
          </p>
        )}
      </TeamPage>
    );
  }

  const memberByPubkey = new Map(
    members.map((member) => [member.pubkey, member]),
  );
  const managerName = (member: TeamMember) => {
    const managerPubkey = member.position?.head.managerPubkey;
    const manager = managerPubkey ? memberByPubkey.get(managerPubkey) : null;
    return manager ? displayName(manager, profiles) : null;
  };
  const employeeCount = members.filter(
    (member) => member.kind === "employee",
  ).length;
  const peopleCount = members.length - employeeCount;

  return (
    <TeamPage testId="company-team-screen" title="Team">
      <div className="team-head">
        <div className="team-head-copy">
          <TeamPageTitle>Team</TeamPageTitle>
          <span className="team-subtitle" data-testid="company-team-counts">
            {countLabel(employeeCount, "AI employee", "AI employees")} and{" "}
            {countLabel(peopleCount, "person", "people")}
          </span>
        </div>
        {canHire ? (
          <button
            className="team-hire-button"
            onClick={() => void goHireRoles()}
            type="button"
          >
            <PlusIcon aria-hidden="true" size={17} strokeWidth={2.4} />
            Hire employee
          </button>
        ) : null}
      </div>
      <div className="team-card">
        <div className="team-table" data-testid="company-team-list">
          <div aria-hidden="true" className="team-table-head">
            <span>Teammate</span>
            <span>Reports to</span>
            <span>Status</span>
            <span />
          </div>
          {members.map((member) => (
            <TeamMemberRow
              avatarUrl={profiles[member.pubkey]?.avatarUrl}
              definitionAvatar={
                personasQuery.data?.find(
                  (persona) => persona.id === member.managedAgent?.personaId,
                )?.avatarUrl
              }
              jobTitle={resolveJobTitle({
                profile: profiles[member.pubkey],
                positionTitle: member.position?.head.title,
                isOwner: member.role === "owner",
              })}
              key={member.pubkey}
              managerName={managerName(member)}
              member={member}
              name={displayName(member, profiles)}
            />
          ))}
        </div>
      </div>
      {members.length === 0 ? (
        <p className="team-message" role="status">
          No team members found.
        </p>
      ) : null}
      <p className="team-note">
        Humans and AI employees can report to either kind of teammate. Reporting
        lines do not grant spending or credential authority.
      </p>
    </TeamPage>
  );
}
