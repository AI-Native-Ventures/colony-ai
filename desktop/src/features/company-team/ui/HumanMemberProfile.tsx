import { useIdentityQuery } from "@/shared/api/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useJobTitle } from "@/features/profile/useJobTitle";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { TeamMember } from "../teamModels";
import { TeamPage, TeamPageTitle } from "./TeamPage";

/**
 * A person's page: who they are, their job title and who they report to. The
 * job title is the one on their profile, so it reads the same in every client.
 */
export function HumanMemberProfile({
  member,
  fullName,
  title,
  reportsTo,
  canManage,
  onEdit,
}: {
  member: TeamMember;
  fullName: string;
  title: string;
  reportsTo: string;
  canManage: boolean;
  onEdit: () => void;
  /** Kept for the page that opens this one; the simple profile has no tabs. */
  initialTab?: string;
  onBack?: () => void;
  directReports?: Array<{ pubkey: string; name: string; title: string }>;
  onOpenMember?: (pubkey: string) => void;
}) {
  const identity = useIdentityQuery();
  const profiles = useUsersBatchQuery([member.pubkey]);
  const jobTitle = useJobTitle(member.pubkey, {
    isOwner: member.role === "owner",
    positionTitle: title,
  });
  const isSelf =
    identity.data?.pubkey.toLowerCase() === member.pubkey.toLowerCase();
  const reports =
    member.role === "owner"
      ? "Company owner"
      : reportsTo || "Reporting line not set";

  return (
    <TeamPage testId="company-team-member-profile" title={fullName}>
      <div className="team-profile-head">
        <ProfileAvatar
          avatarUrl={profiles.data?.profiles[member.pubkey]?.avatarUrl ?? null}
          className="team-profile-avatar"
          label={fullName}
        />
        <div className="team-profile-heading">
          <TeamPageTitle>{fullName}</TeamPageTitle>
          <span className="team-profile-subtitle">
            {jobTitle ? `${jobTitle} · ` : ""}Human
          </span>
        </div>
      </div>
      <section
        aria-labelledby="team-human-role"
        className="team-profile-card"
        data-testid="company-human-role"
      >
        <h2 className="team-profile-card-title" id="team-human-role">
          Role and reporting
        </h2>
        <dl className="team-profile-facts">
          <dt>Title</dt>
          <dd>{jobTitle || "Member"}</dd>
          <dt>Reports to</dt>
          <dd>{reports}</dd>
          <dt>Kind</dt>
          <dd>Human</dd>
        </dl>
        {canManage || isSelf ? (
          <button
            className="team-profile-button"
            onClick={onEdit}
            type="button"
          >
            Edit role and reporting
          </button>
        ) : null}
      </section>
    </TeamPage>
  );
}
