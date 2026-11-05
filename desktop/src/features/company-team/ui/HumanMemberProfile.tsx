import * as React from "react";

import { relayMemberPermissions } from "@/features/community-members/memberPermissions";
import { ConfirmMemberRoleDialog } from "@/features/community-members/ui/ConfirmMemberRoleDialog";
import { ConfirmRemoveDialog } from "@/features/community-members/ui/ConfirmRemoveDialog";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { RelayMember, RelayMemberRole } from "@/shared/api/types";
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
  onRemoved,
  relayMember,
  viewerPubkey,
  viewerRole,
}: {
  member: TeamMember;
  fullName: string;
  title: string;
  reportsTo: string;
  canManage: boolean;
  onEdit: () => void;
  onRemoved: () => void | Promise<void>;
  relayMember: RelayMember | null;
  viewerPubkey?: string;
  viewerRole: RelayMemberRole | null;
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
  const [accessDialog, setAccessDialog] = React.useState<
    "change-role" | "remove" | null
  >(null);
  const permissions = relayMember
    ? relayMemberPermissions({
        currentPubkey: viewerPubkey,
        member: relayMember,
        viewerRole,
      })
    : { canChangeRole: false, canRemove: false };

  return (
    <TeamPage testId="company-team-member-profile" title={fullName}>
      <div className="team-profile-head">
        <ProfileAvatar
          avatarUrl={profiles.data?.profiles[member.pubkey]?.avatarUrl ?? null}
          className="team-profile-avatar"
          label={fullName}
          pubkey={member.pubkey}
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
      {relayMember ? (
        <section
          aria-labelledby="team-human-access"
          className="team-profile-card"
          data-testid="company-human-access"
        >
          <h2 className="team-profile-card-title" id="team-human-access">
            Company access
          </h2>
          <dl className="team-profile-facts">
            <dt>Access role</dt>
            <dd>
              {relayMember.role === "admin"
                ? "Admin"
                : relayMember.role === "owner"
                  ? "Owner"
                  : "Member"}
            </dd>
          </dl>
          {permissions.canChangeRole || permissions.canRemove ? (
            <div className="team-profile-actions">
              {permissions.canChangeRole ? (
                <button
                  className="team-profile-button"
                  data-testid="company-team-change-access-role"
                  onClick={() => setAccessDialog("change-role")}
                  type="button"
                >
                  Change access role
                </button>
              ) : null}
              {permissions.canRemove ? (
                <button
                  className="team-profile-button"
                  data-testid="company-team-remove-member"
                  data-variant="danger"
                  onClick={() => setAccessDialog("remove")}
                  type="button"
                >
                  Remove from company
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <ConfirmMemberRoleDialog
        displayName={fullName}
        member={relayMember}
        onOpenChange={(open) => {
          if (!open) setAccessDialog(null);
        }}
        open={accessDialog === "change-role"}
      />
      <ConfirmRemoveDialog
        displayName={fullName}
        member={relayMember}
        onOpenChange={(open) => {
          if (!open) setAccessDialog(null);
        }}
        onRemoved={onRemoved}
        open={accessDialog === "remove"}
      />
    </TeamPage>
  );
}
