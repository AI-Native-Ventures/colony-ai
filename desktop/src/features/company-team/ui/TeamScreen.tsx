import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { useEmployeeRuntime } from "../useEmployeeRuntime";
import { usePersonasQuery } from "@/features/agents/hooks";
import { Badge } from "@/shared/ui/badge";
import { TeamPage, TeamPageTitle } from "./TeamPage";
import { Button } from "@/shared/ui/button";
import { useCompanyTeamQuery } from "../teamRelay";
import type { TeamMember } from "../teamModels";

function displayName(
  member: TeamMember,
  profiles: Record<string, { displayName: string | null }>,
) {
  return (
    profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function memberKindLabel(member: TeamMember) {
  return member.kind === "employee" ? "Employee" : "Human";
}

function memberTitle(member: TeamMember) {
  return (
    member.position?.head.title.trim() ||
    (member.role === "owner" ? "Founder" : "")
  );
}

function memberStatus(member: TeamMember) {
  return (
    member.position?.head.status ??
    (member.kind === "human" ? "active" : "Needs attention")
  );
}

function TeamMemberRow({
  member,
  name,
  managerName,
  avatarUrl,
  definitionAvatar,
}: {
  member: TeamMember;
  name: string;
  managerName: string | null;
  avatarUrl?: string | null;
  definitionAvatar?: string | null;
}) {
  const { goTeamMember } = useAppNavigation();
  const title = memberTitle(member);
  const runtime = useEmployeeRuntime(member);
  const status =
    member.kind === "employee" ? runtime.label : memberStatus(member);
  const reason = member.position?.head.reason;
  const managerDescription = managerName ? `, Reports to ${managerName}` : "";
  const reasonDescription = reason ? `, Reason: ${reason}` : "";
  const accessibleName = `${name}, ${title || "No title"}, ${memberKindLabel(member)}, ${status}${managerDescription}${reasonDescription}`;
  const rowContents = (
    <>
      <span className="flex min-w-0 items-center gap-[0.9375rem]">
        {member.kind === "employee" ? (
          <EmployeeAvatar
            name={name}
            profile={avatarUrl}
            instance={member.managedAgent?.avatarUrl}
            definition={definitionAvatar}
            personaId={member.managedAgent?.personaId}
            className="size-[2.125rem] shrink-0"
            testId={`team-avatar-${member.pubkey}`}
          />
        ) : (
          <span
            aria-hidden="true"
            className={`grid size-[2.125rem] shrink-0 place-items-center rounded-[0.625rem] text-2xs font-semibold text-primary bg-accent`}
          >
            {name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-compact font-semibold text-foreground">
            {name}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {title ? `${title} · ` : ""}
            {memberKindLabel(member)}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-10">
        {managerName ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Reports to {managerName}
          </span>
        ) : member.role === "owner" ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Company owner
          </span>
        ) : null}
        <Badge
          className={`rounded-[0.3125rem] border-0 px-2 py-1 text-badge font-semibold normal-case leading-relaxed tracking-normal ${status === "active" || status === "Ready" || status === "Working" ? "bg-colony-success/10 text-colony-success" : (status === "Offline" || status === "Loading") ? "bg-muted text-muted-foreground" : "bg-accent text-primary"}`}
          variant="secondary"
        >
          {status}
        </Badge>
      </span>
    </>
  );
  const className =
    "group relative flex min-h-[4.5625rem] w-full items-center justify-between gap-4 border-b border-border px-2 py-[1.0625rem] text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const onClick = () => void goTeamMember(member.pubkey);
  return (
    <button
      aria-label={accessibleName}
      className={className}
      data-testid={`company-team-member-${member.pubkey}`}
      onClick={onClick}
      type="button"
    >
      {rowContents}
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
  const profiles = profilesQuery.data?.profiles ?? {};
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
      <TeamPage title="Team" testId="company-team-screen">
        <TeamPageTitle>Team</TeamPageTitle>
        {teamQuery.isLoading ? (
          <p aria-live="polite" className="mt-6 text-sm text-muted-foreground">
            Loading Team
          </p>
        ) : teamQuery.isError ? (
          <div role="alert" className="mt-6">
            <p className="text-sm">This information could not load</p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void teamQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="mt-6 text-sm text-muted-foreground">
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

  return (
    <TeamPage title="Team" testId="company-team-screen">
      <div className="mb-[1.875rem] mt-2 flex items-center justify-between gap-5">
        <TeamPageTitle>Team</TeamPageTitle>
        {canHire ? (
          <Button
            className="rounded-[0.4375rem] h-auto min-h-10 bg-colony-info px-[0.9375rem] py-[0.6875rem] text-xs shadow-none"
            onClick={() => void goHireRoles()}
            type="button"
          >
            Hire employee
          </Button>
        ) : null}
      </div>
      <div data-testid="company-team-list">
        {members.map((member) => (
          <TeamMemberRow
            avatarUrl={profiles[member.pubkey]?.avatarUrl}
            definitionAvatar={
              personasQuery.data?.find(
                (persona) => persona.id === member.managedAgent?.personaId,
              )?.avatarUrl
            }
            key={member.pubkey}
            managerName={managerName(member)}
            member={member}
            name={displayName(member, profiles)}
          />
        ))}
      </div>
      {members.length === 0 ? (
        <p
          className="py-8 text-center text-sm text-muted-foreground"
          role="status"
        >
          No team members found.
        </p>
      ) : null}
      <p className="mt-[1.5625rem] border-t border-border pt-[0.9375rem] text-2xs text-muted-foreground">
        Humans and employees can report to either kind of teammate. Reporting
        lines do not grant spending or credential authority.
      </p>
    </TeamPage>
  );
}
