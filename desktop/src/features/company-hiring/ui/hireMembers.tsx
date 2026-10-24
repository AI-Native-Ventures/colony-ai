import type { AgentPersona } from "@/shared/api/types";
import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { resolveJobTitle } from "@/features/profile/lib/jobTitle";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { truncateNpub } from "@/shared/lib/pubkey";
import { UserAvatar } from "@/shared/ui/UserAvatar";

/** A team member's display name: profile first, then the directory name. */
export function memberName(member: TeamMember, profiles: UserProfileLookup) {
  return (
    profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

/** A team member's job title, shown beside their name ("Scout · Chief of Staff"). */
export function memberJobTitle(
  member: TeamMember,
  profiles: UserProfileLookup,
) {
  return resolveJobTitle({
    profile: profiles[member.pubkey],
    positionTitle: member.position?.head.title,
    isOwner: member.role === "owner",
  });
}

/** "Name · Job title", or just the name when there is no title. */
export function memberOptionLabel(
  member: TeamMember,
  profiles: UserProfileLookup,
) {
  const title = memberJobTitle(member, profiles);
  const name = memberName(member, profiles);
  return title ? `${name} · ${title}` : name;
}

/** Agents keep their ant-head squircle; people stay round. */
export function MemberAvatar({
  className,
  member,
  personas,
  profiles,
}: {
  className?: string;
  member: TeamMember;
  personas?: readonly AgentPersona[];
  profiles: UserProfileLookup;
}) {
  const name = memberName(member, profiles);
  if (member.kind === "employee") {
    return (
      <EmployeeAvatar
        className={className}
        definition={
          personas?.find(
            (persona) => persona.id === member.managedAgent?.personaId,
          )?.avatarUrl
        }
        instance={member.managedAgent?.avatarUrl}
        name={name}
        personaId={member.managedAgent?.personaId}
        profile={profiles[member.pubkey]?.avatarUrl}
      />
    );
  }
  return (
    <UserAvatar
      avatarUrl={profiles[member.pubkey]?.avatarUrl ?? null}
      className={className}
      displayName={name}
    />
  );
}
